import { describe, it, expect, vi } from "vitest";
import {
  shouldEditorClaimFocus,
  EDITOR_FOCUS_EVENT,
  dispatchEditorFocusRequest,
  isEditorChrome,
} from "./editorFocus";

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

describe("dispatchEditorFocusRequest", () => {
  it("emits lit:request-editor-focus on window", () => {
    const spy = vi.fn();
    window.addEventListener(EDITOR_FOCUS_EVENT, spy);
    dispatchEditorFocusRequest();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as Event).type).toBe("lit:request-editor-focus");
    window.removeEventListener(EDITOR_FOCUS_EVENT, spy);
  });
});

describe("isEditorChrome", () => {
  it("returns false for null", () => {
    expect(isEditorChrome(null)).toBe(false);
  });

  it("returns true for an element inside [data-testid='editor-pane']", () => {
    const pane = document.createElement("div");
    pane.setAttribute("data-testid", "editor-pane");
    const child = document.createElement("div");
    pane.appendChild(child);
    expect(isEditorChrome(child)).toBe(true);
    expect(isEditorChrome(pane)).toBe(true);
  });

  it("returns true for an element with class cm-editor or a descendant", () => {
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const child = document.createElement("div");
    cm.appendChild(child);
    expect(isEditorChrome(cm)).toBe(true);
    expect(isEditorChrome(child)).toBe(true);
  });

  it("returns false for a [role='tree'] child", () => {
    const tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    const child = document.createElement("button");
    tree.appendChild(child);
    expect(isEditorChrome(child)).toBe(false);
    expect(isEditorChrome(tree)).toBe(false);
  });

  it("returns false for a standalone input", () => {
    const input = document.createElement("input");
    expect(isEditorChrome(input)).toBe(false);
  });
});
