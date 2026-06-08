import { describe, it, expect, beforeEach } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  registerPaneView,
  unregisterPaneView,
  getPaneView,
  setFocusedPane,
  setCurrentEditorView,
  getCurrentEditorView,
  isFocusInsideContentPane,
  isEditorFocused,
  _resetForTesting,
} from "./editorViewRef";

function fakeView(label: string): EditorView {
  return { __label: label } as unknown as EditorView;
}

function fakeViewWithDom(dom: HTMLElement): EditorView {
  return { dom } as unknown as EditorView;
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

describe("isFocusInsideContentPane", () => {
  beforeEach(() => {
    _resetForTesting();
    // Clean up any DOM elements added during tests
    document.body.innerHTML = "";
    // Reset focus to body
    (document.activeElement as HTMLElement)?.blur?.();
  });

  it("returns false when nothing is focused (activeElement is body)", () => {
    expect(isFocusInsideContentPane()).toBe(false);
  });

  it("returns true when activeElement is inside a registered EditorView's DOM", () => {
    const container = document.createElement("div");
    const inner = document.createElement("input");
    container.appendChild(inner);
    document.body.appendChild(container);

    const view = fakeViewWithDom(container);
    registerPaneView("pane1", view);

    inner.focus();
    expect(document.activeElement).toBe(inner);
    expect(isFocusInsideContentPane()).toBe(true);
  });

  it("returns true when activeElement is inside [data-testid='editor-pane'] but NOT inside any registered EditorView", () => {
    const paneWrapper = document.createElement("div");
    paneWrapper.setAttribute("data-testid", "editor-pane");
    const inner = document.createElement("input");
    paneWrapper.appendChild(inner);
    document.body.appendChild(paneWrapper);

    // No EditorView registered for this pane
    inner.focus();
    expect(document.activeElement).toBe(inner);
    expect(isFocusInsideContentPane()).toBe(true);
  });

  it("returns true when activeElement is inside [data-testid='pdf-viewer-pane'] (PDF pane, not a registered EditorView)", () => {
    const paneWrapper = document.createElement("div");
    paneWrapper.setAttribute("data-testid", "pdf-viewer-pane");
    paneWrapper.setAttribute("tabindex", "-1");
    document.body.appendChild(paneWrapper);

    // PDF panes never register an EditorView; focus the wrapper itself
    paneWrapper.focus();
    expect(document.activeElement).toBe(paneWrapper);
    expect(isFocusInsideContentPane()).toBe(true);
  });

  it("returns false when activeElement is outside all pane areas (e.g., sidebar)", () => {
    const sidebar = document.createElement("div");
    sidebar.setAttribute("data-testid", "sidebar");
    const button = document.createElement("button");
    sidebar.appendChild(button);
    document.body.appendChild(sidebar);

    button.focus();
    expect(document.activeElement).toBe(button);
    expect(isFocusInsideContentPane()).toBe(false);
  });

  it("returns false when document.activeElement is null/body", () => {
    // activeElement defaults to body when nothing focused
    expect(document.activeElement).toBe(document.body);
    expect(isFocusInsideContentPane()).toBe(false);
  });

  it("returns true when focus is on pane wrapper div itself", () => {
    const paneWrapper = document.createElement("div");
    paneWrapper.setAttribute("data-testid", "editor-pane");
    paneWrapper.setAttribute("tabindex", "0");
    document.body.appendChild(paneWrapper);

    paneWrapper.focus();
    expect(document.activeElement).toBe(paneWrapper);
    expect(isFocusInsideContentPane()).toBe(true);
  });
});

describe("isEditorFocused", () => {
  beforeEach(() => {
    _resetForTesting();
    document.body.innerHTML = "";
    (document.activeElement as HTMLElement)?.blur?.();
  });

  it("returns true when editor view exists and focus is inside content pane", () => {
    const container = document.createElement("div");
    const inner = document.createElement("input");
    container.appendChild(inner);
    document.body.appendChild(container);

    const view = fakeViewWithDom(container);
    registerPaneView("pane1", view);
    setFocusedPane("pane1");

    inner.focus();
    expect(isEditorFocused()).toBe(true);
  });

  it("returns false when editor view exists but focus is outside content pane", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const view = fakeViewWithDom(container);
    registerPaneView("pane1", view);
    setFocusedPane("pane1");

    const sidebar = document.createElement("button");
    document.body.appendChild(sidebar);
    sidebar.focus();
    expect(isEditorFocused()).toBe(false);
  });

  it("returns false when focus is inside content pane but no editor view is current", () => {
    const paneWrapper = document.createElement("div");
    paneWrapper.setAttribute("data-testid", "editor-pane");
    const inner = document.createElement("input");
    paneWrapper.appendChild(inner);
    document.body.appendChild(paneWrapper);

    inner.focus();
    expect(isFocusInsideContentPane()).toBe(true);
    expect(getCurrentEditorView()).toBeNull();
    expect(isEditorFocused()).toBe(false);
  });

  it("returns false when neither condition is met", () => {
    expect(isEditorFocused()).toBe(false);
  });
});
