import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

let container: HTMLDivElement;
let buttons: HTMLButtonElement[];

function makeContainer() {
  container = document.createElement("div");
  buttons = Array.from({ length: 3 }, (_, i) => {
    const btn = document.createElement("button");
    btn.textContent = `Button ${i}`;
    container.appendChild(btn);
    return btn;
  });
  document.body.appendChild(container);
}

beforeEach(() => {
  document.body.innerHTML = "";
  makeContainer();
});

describe("useFocusTrap", () => {
  it("Tab on last focusable element wraps to first", () => {
    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, true));
    buttons[2]!.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(event, "preventDefault", { value: () => {} });
    container.dispatchEvent(event);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("Shift+Tab on first focusable element wraps to last", () => {
    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, true));
    buttons[0]!.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "preventDefault", { value: () => {} });
    container.dispatchEvent(event);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("does not trap when active=false", () => {
    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, false));
    buttons[2]!.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    container.dispatchEvent(event);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("focuses first element on mount", () => {
    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, true));
    expect(document.activeElement).toBe(buttons[0]);
  });
});
