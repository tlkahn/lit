import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
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
});
