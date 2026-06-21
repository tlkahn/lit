import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { useOverflowMenu } from "./useOverflowMenu";

describe("useOverflowMenu", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useOverflowMenu());
    expect(result.current.open).toBe(false);
  });

  it("toggles open/close", () => {
    const { result } = renderHook(() => useOverflowMenu());
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
  });

  it("closes on Escape key", () => {
    const { result } = renderHook(() => useOverflowMenu());
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.open).toBe(false);
  });

  it("closes on click outside", () => {
    const { result } = renderHook(() => useOverflowMenu());

    const trigger = document.createElement("button");
    const menu = document.createElement("div");
    document.body.appendChild(trigger);
    document.body.appendChild(menu);
    Object.defineProperty(result.current.triggerRef, "current", { value: trigger, writable: true });
    Object.defineProperty(result.current.menuRef, "current", { value: menu, writable: true });

    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);

    const outside = document.createElement("span");
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.open).toBe(false);

    document.body.removeChild(trigger);
    document.body.removeChild(menu);
    document.body.removeChild(outside);
  });

  it("does not close on click inside trigger", () => {
    const { result } = renderHook(() => useOverflowMenu());

    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    Object.defineProperty(result.current.triggerRef, "current", { value: trigger, writable: true });

    act(() => result.current.setOpen(true));

    act(() => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.open).toBe(true);

    document.body.removeChild(trigger);
  });

  it("closes on scroll while open", () => {
    const { result } = renderHook(() => useOverflowMenu());
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.open).toBe(false);
  });

  it("does not close on scroll when already closed", () => {
    const { result } = renderHook(() => useOverflowMenu());
    expect(result.current.open).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    // Should remain closed without errors
    expect(result.current.open).toBe(false);
  });

  it("uses useLayoutEffect (not useEffect) for positioning to avoid flash at (0,0)", () => {
    // Read the hook source to verify the positioning effect uses useLayoutEffect.
    // useLayoutEffect fires pre-paint, preventing the menu from flashing at (0,0)
    // before being repositioned. useEffect fires post-paint and causes a visible flicker.
    const src = readFileSync(
      resolve(__dirname, "useOverflowMenu.ts"),
      "utf-8",
    );

    // The positioning block writes to menu.style.left / menu.style.top.
    // It must be wrapped in useLayoutEffect, not useEffect.
    const positioningPattern = /useLayoutEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?style\.left/;
    expect(src).toMatch(positioningPattern);
  });

  it("accepts an optional config object with anchor and dismissOnScroll options", () => {
    // The hook should accept a config parameter to generalize positioning and dismissal
    const { result } = renderHook(() =>
      useOverflowMenu({ anchor: "above-left", dismissOnScroll: false }),
    );
    expect(result.current.open).toBe(false);
    expect(result.current.setOpen).toBeInstanceOf(Function);
    expect(result.current.triggerRef).toBeDefined();
    expect(result.current.menuRef).toBeDefined();
  });

  it("does not close on scroll when dismissOnScroll is false", () => {
    const { result } = renderHook(() =>
      useOverflowMenu({ dismissOnScroll: false }),
    );
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    // Should remain open because dismissOnScroll is false
    expect(result.current.open).toBe(true);
  });
});
